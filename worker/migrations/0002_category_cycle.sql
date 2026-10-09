-- Phase 2 / F03: reject a category write that would make the persisted graph cyclic.
-- The recursive walk is bounded and tracks visited ids so a pre-existing corrupt
-- graph cannot make a write hang forever.
CREATE TRIGGER IF NOT EXISTS trg_sync_category_no_cycle_insert
AFTER INSERT ON sync_records
WHEN NEW.entity = 'category' AND NEW.deleted_at IS NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE ancestors(id, path, depth) AS (
      SELECT json_extract(NEW.payload, '$.parentId'),
             '|' || json_extract(NEW.payload, '$.parentId') || '|',
             1
      WHERE json_extract(NEW.payload, '$.parentId') IS NOT NULL
      UNION ALL
      SELECT json_extract(parent.payload, '$.parentId'),
             ancestors.path || json_extract(parent.payload, '$.parentId') || '|',
             ancestors.depth + 1
      FROM ancestors
      JOIN sync_records parent
        ON parent.entity = 'category'
       AND parent.entity_id = ancestors.id
       AND parent.deleted_at IS NULL
      WHERE ancestors.id IS NOT NULL
        AND ancestors.depth < 10000
        AND instr(ancestors.path, '|' || json_extract(parent.payload, '$.parentId') || '|') = 0
    )
    SELECT 1 FROM ancestors WHERE id = NEW.entity_id
  ) THEN RAISE(ABORT, 'category-cycle') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_sync_category_no_cycle_update
AFTER UPDATE OF entity, entity_id, payload, deleted_at ON sync_records
WHEN NEW.entity = 'category' AND NEW.deleted_at IS NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE ancestors(id, path, depth) AS (
      SELECT json_extract(NEW.payload, '$.parentId'),
             '|' || json_extract(NEW.payload, '$.parentId') || '|',
             1
      WHERE json_extract(NEW.payload, '$.parentId') IS NOT NULL
      UNION ALL
      SELECT json_extract(parent.payload, '$.parentId'),
             ancestors.path || json_extract(parent.payload, '$.parentId') || '|',
             ancestors.depth + 1
      FROM ancestors
      JOIN sync_records parent
        ON parent.entity = 'category'
       AND parent.entity_id = ancestors.id
       AND parent.deleted_at IS NULL
      WHERE ancestors.id IS NOT NULL
        AND ancestors.depth < 10000
        AND instr(ancestors.path, '|' || json_extract(parent.payload, '$.parentId') || '|') = 0
    )
    SELECT 1 FROM ancestors WHERE id = NEW.entity_id
  ) THEN RAISE(ABORT, 'category-cycle') END;
END;
