-- Remove category-level tithe participant flag.
-- Tithe participants are now controlled only at subcategory level.
ALTER TABLE "Category"
DROP COLUMN "isTitheParticipant";
