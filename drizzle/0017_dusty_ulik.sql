ALTER TABLE `attendances` ADD `capturedAt` timestamp DEFAULT (now()) NOT NULL;
