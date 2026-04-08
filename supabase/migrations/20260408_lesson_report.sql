-- Add report column to lessons table (stores web search report text)
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS report text;
