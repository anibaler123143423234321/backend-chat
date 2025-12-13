-- =====================================================
-- Tabla: recent_searches
-- Descripción: Almacena las búsquedas recientes de usuarios
-- =====================================================

CREATE TABLE IF NOT EXISTS `recent_searches` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(255) NOT NULL COMMENT 'Usuario que realizó la búsqueda',
  `search_term` VARCHAR(500) NOT NULL COMMENT 'Término de búsqueda',
  `search_type` ENUM('user', 'room', 'message', 'general') DEFAULT 'general' COMMENT 'Tipo de búsqueda',
  `result_count` INT DEFAULT 0 COMMENT 'Cantidad de resultados encontrados',
  `clicked_result_id` VARCHAR(255) NULL COMMENT 'ID del resultado clickeado (opcional)',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Fecha de creación',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Fecha de actualización',
  
  -- Índices para optimizar consultas
  INDEX `idx_username` (`username`),
  INDEX `idx_username_created` (`username`, `created_at` DESC),
  INDEX `idx_search_term` (`search_term`),
  
  -- Constraint para evitar duplicados exactos recientes
  UNIQUE KEY `unique_user_search` (`username`, `search_term`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Búsquedas recientes de usuarios';

-- =====================================================
-- Trigger para limitar búsquedas por usuario (máximo 20)
-- =====================================================

DELIMITER $$

CREATE TRIGGER `limit_recent_searches_per_user`
AFTER INSERT ON `recent_searches`
FOR EACH ROW
BEGIN
  DECLARE search_count INT;
  
  -- Contar búsquedas del usuario
  SELECT COUNT(*) INTO search_count
  FROM recent_searches
  WHERE username = NEW.username;
  
  -- Si excede 20, eliminar las más antiguas
  IF search_count > 20 THEN
    DELETE FROM recent_searches
    WHERE username = NEW.username
    ORDER BY created_at ASC
    LIMIT (search_count - 20);
  END IF;
END$$

DELIMITER ;

-- =====================================================
-- Datos de ejemplo (opcional - comentar si no se necesita)
-- =====================================================

-- INSERT INTO recent_searches (username, search_term, search_type, result_count) VALUES
-- ('admin', 'Juan Pérez', 'user', 1),
-- ('admin', 'Sala General', 'room', 1),
-- ('admin', 'proyecto', 'message', 15);

