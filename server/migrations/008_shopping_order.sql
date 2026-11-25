-- Shopping list entries can be put in any order by dragging. Positions are per parent
-- (top-level items share one sequence, each item's sub-items another). Existing entries
-- keep the order they had, which was the order they were added in.
ALTER TABLE shopping_items ADD COLUMN position integer NOT NULL DEFAULT 0;

UPDATE shopping_items s
SET position = o.n
FROM (
  SELECT id, row_number() OVER (PARTITION BY parent_id ORDER BY created_at, id) AS n
  FROM shopping_items
) o
WHERE s.id = o.id;
