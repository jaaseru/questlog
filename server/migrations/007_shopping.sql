-- A shopping list shared by everyone. Items can have one level of sub-items.
-- Checked-off items are deleted 12 hours after being checked off.
CREATE TABLE shopping_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   uuid REFERENCES shopping_items (id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  checked_at  timestamptz,
  checked_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX shopping_items_parent_idx ON shopping_items (parent_id);
CREATE INDEX shopping_items_checked_idx ON shopping_items (checked_at) WHERE checked_at IS NOT NULL;
