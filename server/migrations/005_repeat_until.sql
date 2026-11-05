-- Optional last day of a repeating series (inclusive).
ALTER TABLE task_series ADD COLUMN end_date date;
ALTER TABLE task_series ADD CONSTRAINT task_series_end_after_start CHECK (end_date IS NULL OR end_date >= start_date);
