import { AuthenticatedRequest } from "../../common";
import { Body, Controller, Delete, Get, HttpStatus, Param, Post, Put, Query, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery } from '@nestjs/swagger';

import { RestrictedGuard } from '../../common';

import { SubcategoryData, SubcategoryInput } from '../model';
import { SubcategoryService } from '../service';

@Controller('subcategories')
@ApiTags('subcategorias')
@ApiBearerAuth()
@UseGuards(RestrictedGuard)
export class SubcategoryController {

    public constructor(
        private readonly subcategoryService: SubcategoryService
    ) { }

    @Get()
    @ApiOperation({ 
        summary: 'Listar todas as subcategorias do usuário autenticado',
        description: 'Retorna todas as subcategorias do usuário autenticado, com opção de filtrar por categoria. Subcategorias são os itens específicos de despesas ou rendas dentro de uma categoria maior. Por exemplo, dentro da categoria "Moradia", você pode ter subcategorias como "Aluguel", "Condomínio", "Energia", "Água". Use o parâmetro categoryId para filtrar subcategorias de uma categoria específica, facilitando a visualização organizada de seus itens financeiros. Por padrão, subcategorias escondidas não são retornadas.'
    })
    @ApiQuery({ name: 'categoryId', required: false, description: 'ID da categoria para filtrar subcategorias' })
    @ApiQuery({ name: 'groupId', required: false, description: 'Filtrar por ID do grupo' })
    @ApiQuery({ name: 'includeHidden', required: false, description: 'Incluir subcategorias escondidas' })
    @ApiResponse({ status: HttpStatus.OK, isArray: true, type: SubcategoryData, description: 'Lista de subcategorias retornada com sucesso' })
    @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Token JWT ausente ou inválido' })
    public async find(
        @Query('categoryId') categoryId?: string,
        @Query('groupId') groupId?: string,
        @Query('includeHidden') includeHidden?: string,
        @Request() req?: AuthenticatedRequest
    ): Promise<SubcategoryData[]> {
        const userId = req?.user?.userId || 1;
        return this.subcategoryService.findByUser(
            userId,
            categoryId ? parseInt(categoryId) : undefined,
            groupId ? parseInt(groupId) : undefined,
            includeHidden === 'true'
        );
    }

    @Get(':id')
    @ApiParam({ name: 'id', description: 'ID único da subcategoria' })
    @ApiOperation({ 
        summary: 'Buscar uma subcategoria específica por ID',
        description: 'Retorna os detalhes completos de uma subcategoria identificada pelo seu ID. A subcategoria deve pertencer ao usuário autenticado. Este endpoint fornece informações sobre a subcategoria incluindo seu nome, categoria pai associada e tipo (despesa ou renda). É útil para verificar os dados antes de fazer edições ou para exibir informações detalhadas da subcategoria.'
    })
    @ApiResponse({ status: HttpStatus.OK, type: SubcategoryData, description: 'Subcategoria encontrada e retornada com sucesso' })
    @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Subcategoria não encontrada ou não pertence ao usuário' })
    @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Token JWT ausente ou inválido' })
    public async findById(@Param('id') id: string, @Request() req: AuthenticatedRequest): Promise<SubcategoryData> {
        const userId = req?.user?.userId || 1;
        const subcategory = await this.subcategoryService.findById(parseInt(id), userId);
        if (!subcategory) {
            throw new Error('Subcategoria não encontrada');
        }
        return subcategory;
    }

    @Post()
    @ApiOperation({ 
        summary: 'Criar uma nova subcategoria',
        description: 'Cria uma nova subcategoria vinculada a uma categoria existente. Você deve fornecer o nome da subcategoria e o ID da categoria pai. As subcategorias representam itens específicos de despesas ou rendas. Por exemplo, dentro da categoria "Alimentação", você pode criar subcategorias como "Supermercado", "Restaurantes", "Lanches". Cada subcategoria será usada posteriormente para registrar transações e definir orçamentos detalhados.'
    })
    @ApiResponse({ status: HttpStatus.CREATED, type: SubcategoryData, description: 'Subcategoria criada com sucesso' })
    @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Dados inválidos ou categoria pai não encontrada' })
    @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Token JWT ausente ou inválido' })
    public async create(@Body() input: SubcategoryInput, @Request() req: AuthenticatedRequest): Promise<SubcategoryData> {
        const userId = req?.user?.userId || 1;
        return this.subcategoryService.create(userId, input);
    }

    @Put(':id')
    @ApiParam({ name: 'id', description: 'ID único da subcategoria a ser atualizada' })
    @ApiOperation({ 
        summary: 'Atualizar uma subcategoria existente',
        description: 'Atualiza as informações de uma subcategoria existente. Você pode modificar o nome da subcategoria ou movê-la para outra categoria alterando o categoryId. Esta operação não afeta os orçamentos ou transações já vinculados a esta subcategoria - eles continuam associados. É útil para reorganizar sua estrutura financeira ou corrigir nomes de subcategorias.'
    })
    @ApiResponse({ status: HttpStatus.OK, type: SubcategoryData, description: 'Subcategoria atualizada com sucesso' })
    @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Subcategoria não encontrada ou não pertence ao usuário' })
    @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Dados inválidos ou categoria de destino não encontrada' })
    @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Token JWT ausente ou inválido' })
    public async update(@Param('id') id: string, @Body() input: SubcategoryInput, @Request() req: AuthenticatedRequest): Promise<SubcategoryData> {
        const userId = req?.user?.userId || 1;
        return this.subcategoryService.update(parseInt(id), userId, input);
    }

    @Get(':id/check-transactions')
    @ApiParam({ name: 'id', description: 'ID único da subcategoria' })
    @ApiOperation({ 
        summary: 'Verificar se subcategoria possui transações associadas',
        description: 'Verifica se existem transações associadas a esta subcategoria. Retorna um objeto indicando se há transações e a quantidade total. Útil para exibir avisos antes de excluir uma subcategoria.'
    })
    @ApiResponse({ status: HttpStatus.OK, description: 'Verificação realizada com sucesso' })
    @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Subcategoria não encontrada ou não pertence ao usuário' })
    @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Token JWT ausente ou inválido' })
    public async checkTransactions(@Param('id') id: string, @Request() req: AuthenticatedRequest): Promise<{ hasTransactions: boolean; count: number }> {
        const userId = req?.user?.userId || 1;
        return this.subcategoryService.checkTransactions(parseInt(id), userId);
    }

    @Delete(':id')
    @ApiParam({ name: 'id', description: 'ID único da subcategoria a ser excluída' })
    @ApiQuery({ name: 'deleteTransactions', required: false, description: 'Se true, deleta as transações associadas' })
    @ApiQuery({ name: 'moveToSubcategoryId', required: false, description: 'ID da subcategoria para onde mover as transações' })
    @ApiOperation({ 
        summary: 'Excluir uma subcategoria',
        description: 'Remove permanentemente uma subcategoria do sistema. Se a subcategoria possuir transações associadas, você deve especificar deleteTransactions=true para deletar as transações ou fornecer moveToSubcategoryId para mover as transações para outra subcategoria.'
    })
    @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Subcategoria excluída com sucesso' })
    @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Subcategoria não encontrada ou não pertence ao usuário' })
    @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Subcategoria possui transações e nenhuma ação foi especificada' })
    @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Token JWT ausente ou inválido' })
    public async delete(
        @Param('id') id: string, 
        @Query('deleteTransactions') deleteTransactions?: string,
        @Query('moveToSubcategoryId') moveToSubcategoryId?: string,
        @Request() req?: AuthenticatedRequest
    ): Promise<void> {
        const userId = req?.user?.userId || 1;
        await this.subcategoryService.delete(
            parseInt(id), 
            userId,
            deleteTransactions === 'true',
            moveToSubcategoryId ? parseInt(moveToSubcategoryId) : undefined
        );
    }

    @Put(':id/hide')
    @ApiParam({ name: 'id', description: 'ID único da subcategoria a ser escondida' })
    @ApiOperation({ 
        summary: 'Esconder uma subcategoria',
        description: 'Marca uma subcategoria como escondida. Subcategorias escondidas não aparecem na listagem padrão e não são mostradas ao criar transações, mas as transações existentes permanecem associadas. Útil para subcategorias que não são mais utilizadas mas têm histórico.'
    })
    @ApiResponse({ status: HttpStatus.OK, type: SubcategoryData, description: 'Subcategoria escondida com sucesso' })
    @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Subcategoria não encontrada ou não pertence ao usuário' })
    @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Token JWT ausente ou inválido' })
    public async hide(@Param('id') id: string, @Request() req: AuthenticatedRequest): Promise<SubcategoryData> {
        const userId = req?.user?.userId || 1;
        return this.subcategoryService.hide(parseInt(id), userId);
    }

    @Put(':id/unhide')
    @ApiParam({ name: 'id', description: 'ID único da subcategoria a ser reexibida' })
    @ApiOperation({ 
        summary: 'Reexibir uma subcategoria',
        description: 'Remove a marcação de escondida de uma subcategoria, fazendo com que ela volte a aparecer nas listagens e ao criar transações.'
    })
    @ApiResponse({ status: HttpStatus.OK, type: SubcategoryData, description: 'Subcategoria reexibida com sucesso' })
    @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Subcategoria não encontrada ou não pertence ao usuário' })
    @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Token JWT ausente ou inválido' })
    public async unhide(@Param('id') id: string, @Request() req: AuthenticatedRequest): Promise<SubcategoryData> {
        const userId = req?.user?.userId || 1;
        return this.subcategoryService.unhide(parseInt(id), userId);
    }

    @Put(':id/set-default-fee')
    @ApiParam({ name: 'id', description: 'ID da subcategoria' })
    @ApiOperation({ summary: 'Definir subcategoria como padrão para taxas automáticas (deve ser do tipo EXPENSE)' })
    @ApiResponse({ status: HttpStatus.OK, type: SubcategoryData })
    @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Subcategoria não é do tipo EXPENSE' })
    @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Subcategoria não encontrada' })
    public async setDefaultFee(@Param('id') id: string, @Request() req: AuthenticatedRequest): Promise<SubcategoryData> {
        const userId = req?.user?.userId || 1;
        return this.subcategoryService.setDefaultFeeSubcategory(parseInt(id), userId);
    }

    @Put(':id/set-default-discount')
    @ApiParam({ name: 'id', description: 'ID da subcategoria' })
    @ApiOperation({ summary: 'Definir subcategoria como padrão para descontos automáticos (deve ser do tipo INCOME)' })
    @ApiResponse({ status: HttpStatus.OK, type: SubcategoryData })
    @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Subcategoria não é do tipo INCOME' })
    @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Subcategoria não encontrada' })
    public async setDefaultDiscount(@Param('id') id: string, @Request() req: AuthenticatedRequest): Promise<SubcategoryData> {
        const userId = req?.user?.userId || 1;
        return this.subcategoryService.setDefaultDiscountSubcategory(parseInt(id), userId);
    }

    @Put('clear-default-fee')
    @ApiOperation({ summary: 'Remover configuração de subcategoria padrão de taxa' })
    @ApiResponse({ status: HttpStatus.OK })
    public async clearDefaultFee(
        @Query('groupId') groupId: string | undefined,
        @Request() req: AuthenticatedRequest
    ): Promise<void> {
        const userId = req?.user?.userId || 1;
        await this.subcategoryService.clearDefaultFeeSubcategory(userId, groupId ? parseInt(groupId) : undefined);
    }

    @Put('clear-default-discount')
    @ApiOperation({ summary: 'Remover configuração de subcategoria padrão de desconto' })
    @ApiResponse({ status: HttpStatus.OK })
    public async clearDefaultDiscount(
        @Query('groupId') groupId: string | undefined,
        @Request() req: AuthenticatedRequest
    ): Promise<void> {
        const userId = req?.user?.userId || 1;
        await this.subcategoryService.clearDefaultDiscountSubcategory(userId, groupId ? parseInt(groupId) : undefined);
    }

    @Put(':id/set-default-tithe')
    @ApiParam({ name: 'id', description: 'ID da subcategoria de despesa' })
    @ApiOperation({ summary: 'Definir subcategoria como padrão para dizimo automático' })
    @ApiResponse({ status: HttpStatus.OK, type: SubcategoryData })
    public async setDefaultTithe(@Param('id') id: string, @Request() req: AuthenticatedRequest): Promise<SubcategoryData> {
        const userId = req?.user?.userId || 1;
        return this.subcategoryService.setDefaultTitheSubcategory(parseInt(id), userId);
    }

    @Put('clear-default-tithe')
    @ApiOperation({ summary: 'Remover configuração de subcategoria padrão de dizimo' })
    @ApiResponse({ status: HttpStatus.OK })
    public async clearDefaultTithe(
        @Query('groupId') groupId: string | undefined,
        @Request() req: AuthenticatedRequest
    ): Promise<void> {
        const userId = req?.user?.userId || 1;
        await this.subcategoryService.clearDefaultTitheSubcategory(userId, groupId ? parseInt(groupId) : undefined);
    }

    @Put(':id/set-tithe-participant')
    @ApiParam({ name: 'id', description: 'ID da subcategoria de renda' })
    @ApiOperation({ summary: 'Marcar subcategoria como participante do cálculo de dizimo' })
    @ApiResponse({ status: HttpStatus.OK, type: SubcategoryData })
    public async setTitheParticipant(@Param('id') id: string, @Request() req: AuthenticatedRequest): Promise<SubcategoryData> {
        const userId = req?.user?.userId || 1;
        return this.subcategoryService.setTitheParticipant(parseInt(id), userId, true);
    }

    @Put(':id/unset-tithe-participant')
    @ApiParam({ name: 'id', description: 'ID da subcategoria de renda' })
    @ApiOperation({ summary: 'Remover subcategoria do cálculo de dizimo' })
    @ApiResponse({ status: HttpStatus.OK, type: SubcategoryData })
    public async unsetTitheParticipant(@Param('id') id: string, @Request() req: AuthenticatedRequest): Promise<SubcategoryData> {
        const userId = req?.user?.userId || 1;
        return this.subcategoryService.setTitheParticipant(parseInt(id), userId, false);
    }

}
