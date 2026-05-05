import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/provider/prisma.provider';

export interface AuditLogEntry {
  userId: number;
  groupId?: number;
  entityType: string;
  entityId: number;
  action: string;
  changes?: Record<string, { before: any; after: any }>;
  description?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria um registro de auditoria
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId,
          groupId: entry.groupId,
          entityType: entry.entityType,
          entityId: entry.entityId,
          action: entry.action,
          changes: entry.changes || {},
          description: entry.description,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
        },
      });
    } catch (error) {
      // Log errors but don't fail the main operation
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[AuditService] Failed to create audit log: ${errorMessage}`);
    }
  }

  /**
   * Busca logs de auditoria com filtros
   */
  async getLogs(filters: {
    userId?: number;
    groupId?: number;
    entityType?: string;
    entityId?: number;
    action?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }) {
    const {
      userId,
      groupId,
      entityType,
      entityId,
      action,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
    } = filters;

    return this.prisma.auditLog.findMany({
      where: {
        ...(userId && { userId }),
        ...(groupId && { groupId }),
        ...(entityType && { entityType }),
        ...(entityId && { entityId }),
        ...(action && { action }),
        ...(startDate || endDate
          ? {
              createdAt: {
                ...(startDate && { gte: startDate }),
                ...(endDate && { lte: endDate }),
              },
            }
          : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Busca logs de auditoria de uma entidade específica
   */
  async getEntityLogs(
    entityType: string,
    entityId: number,
    limit = 20
  ) {
    return this.getLogs({
      entityType,
      entityId,
      limit,
    });
  }

  /**
   * Helper para criar descrição humanizada de mudanças
   */
  generateChangeDescription(
    entityType: string,
    action: string,
    changes?: Record<string, { before: any; after: any }>
  ): string {
    const entityNames: Record<string, string> = {
      Transaction: 'Transação',
      InstallmentPlan: 'Plano de Parcelamento',
      RecurrenceRule: 'Regra de Recorrência',
      Budget: 'Orçamento',
      Category: 'Categoria',
      Subcategory: 'Subcategoria',
      Account: 'Conta',
    };

    const actionNames: Record<string, string> = {
      CREATE: 'criado',
      UPDATE: 'atualizado',
      DELETE: 'deletado',
      CONFIRM: 'confirmado',
      CANCEL: 'cancelado',
      PAUSE: 'pausado',
      RESUME: 'retomado',
    };

    const entityName = entityNames[entityType] || entityType;
    const actionName = actionNames[action] || action;

    if (!changes || Object.keys(changes).length === 0) {
      return `${entityName} ${actionName}`;
    }

    const changedFields = Object.keys(changes);
    const fieldNames: Record<string, string> = {
      amount: 'valor',
      status: 'status',
      title: 'título',
      description: 'descrição',
      date: 'data',
      interestRate: 'taxa de juros',
      endDate: 'data de término',
      occurrenceCount: 'número de ocorrências',
      frequency: 'frequência',
    };

    const descriptions = changedFields.map((field) => {
      const fieldName = fieldNames[field] || field;
      const { before, after } = changes[field];
      return `${fieldName}: ${before} → ${after}`;
    });

    return `${entityName} ${actionName}: ${descriptions.join(', ')}`;
  }

  /**
   * Compara dois objetos e retorna as diferenças
   */
  detectChanges(
    before: Record<string, any>,
    after: Record<string, any>,
    fieldsToCompare: string[]
  ): Record<string, { before: any; after: any }> | undefined {
    const changes: Record<string, { before: any; after: any }> = {};

    for (const field of fieldsToCompare) {
      const beforeValue = before[field];
      const afterValue = after[field];

      // Handle Decimal objects
      const beforeStr = beforeValue?.toString?.() ?? beforeValue;
      const afterStr = afterValue?.toString?.() ?? afterValue;

      if (beforeStr !== afterStr) {
        changes[field] = {
          before: beforeValue,
          after: afterValue,
        };
      }
    }

    return Object.keys(changes).length > 0 ? changes : undefined;
  }
}
