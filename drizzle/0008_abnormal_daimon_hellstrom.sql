CREATE TABLE `report_cards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`learnerId` int NOT NULL,
	`academicYear` int NOT NULL,
	`term` varchar(40) NOT NULL,
	`status` enum('draft','generated','reviewed','approved','published') NOT NULL DEFAULT 'draft',
	`classTeacherComment` text,
	`headTeacherComment` text,
	`generatedByUserId` int,
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `report_cards_id` PRIMARY KEY(`id`),
	CONSTRAINT `report_card_period_unique` UNIQUE(`learnerId`,`academicYear`,`term`)
);
