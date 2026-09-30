CREATE TABLE `resources_finance_state` (
	`id` int NOT NULL,
	`data` longtext NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`updatedByUserId` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `resources_finance_state_id` PRIMARY KEY(`id`)
);
