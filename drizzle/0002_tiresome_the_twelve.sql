CREATE TABLE `expenditures` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`expenditureDate` date NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`category` varchar(120) NOT NULL,
	`description` varchar(255) NOT NULL,
	`responsiblePerson` varchar(160) NOT NULL,
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `expenditures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guardians` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fullName` varchar(160) NOT NULL,
	`phone` varchar(40),
	`email` varchar(320),
	`communicationPreference` enum('sms','email','phone') NOT NULL DEFAULT 'sms',
	CONSTRAINT `guardians_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `learner_guardians` (
	`id` int AUTO_INCREMENT NOT NULL,
	`learnerId` int NOT NULL,
	`guardianId` int NOT NULL,
	`relationship` varchar(80) NOT NULL,
	`isPrimary` int NOT NULL DEFAULT 0,
	CONSTRAINT `learner_guardians_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`audience` enum('parents','staff','learners','all') NOT NULL,
	`title` varchar(160) NOT NULL,
	`body` text NOT NULL,
	`status` enum('draft','published','archived') NOT NULL DEFAULT 'draft',
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`permissionKey` varchar(120) NOT NULL,
	`description` varchar(255) NOT NULL,
	CONSTRAINT `permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `permissions_permissionKey_unique` UNIQUE(`permissionKey`)
);
--> statement-breakpoint
CREATE TABLE `user_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`permissionKey` varchar(120) NOT NULL,
	`allowed` int NOT NULL DEFAULT 1,
	CONSTRAINT `user_permissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `learners` ADD `gender` enum('male','female','other');--> statement-breakpoint
ALTER TABLE `learners` ADD `dateOfBirth` date;--> statement-breakpoint
ALTER TABLE `learners` ADD `contactAddress` varchar(255);--> statement-breakpoint
ALTER TABLE `school_settings` ADD `address` varchar(255);--> statement-breakpoint
ALTER TABLE `school_settings` ADD `phone` varchar(40);--> statement-breakpoint
ALTER TABLE `school_settings` ADD `email` varchar(320);