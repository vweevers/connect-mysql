CREATE TABLE IF NOT EXISTS `sessions` (
  `sid` VARCHAR(255) NOT NULL,
  `session` TEXT NOT NULL,
  `expires` INT(11) DEFAULT NULL,
  PRIMARY KEY (`sid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
