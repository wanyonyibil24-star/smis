CREATE TABLE `assessments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`learnerId` int NOT NULL,
	`learningArea` varchar(100) NOT NULL,
	`period` varchar(40) NOT NULL,
	`rating` enum('EE','ME','AE','BE') NOT NULL,
	`comment` text,
	`recordedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `assessments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `attendance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`learnerId` int NOT NULL,
	`attendanceDate` varchar(10) NOT NULL,
	`status` enum('present','absent','late','excused') NOT NULL,
	`recordedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `attendance_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`action` varchar(80) NOT NULL,
	`module` varchar(80) NOT NULL,
	`recordId` varchar(80),
	`details` text,
	`confirmed` boolean NOT NULL DEFAULT false,
	`success` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `finance_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`learnerId` int,
	`transactionType` enum('charge','payment') NOT NULL,
	`amount` int NOT NULL,
	`description` varchar(180) NOT NULL,
	`term` varchar(40) NOT NULL,
	`recordedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `finance_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`category` varchar(80) NOT NULL,
	`quantity` int NOT NULL DEFAULT 0,
	`reorderLevel` int NOT NULL DEFAULT 5,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `inventory_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `learners` (
	`id` int AUTO_INCREMENT NOT NULL,
	`admissionNo` varchar(40) NOT NULL,
	`name` varchar(160) NOT NULL,
	`gender` enum('Female','Male','Other') NOT NULL,
	`grade` varchar(30) NOT NULL,
	`guardianPhone` varchar(30),
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `learners_id` PRIMARY KEY(`id`),
	CONSTRAINT `learners_admissionNo_unique` UNIQUE(`admissionNo`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(80) NOT NULL,
	`label` varchar(120) NOT NULL,
	CONSTRAINT `permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `permissions_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`role` enum('super_admin','admin','teacher','class_teacher','finance','storekeeper','staff','user') NOT NULL,
	`permissionId` int NOT NULL,
	CONSTRAINT `role_permissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `teachers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`email` varchar(320),
	`phone` varchar(30),
	`learningAreas` text,
	`grades` text,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `teachers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `timetable` (
	`id` int AUTO_INCREMENT NOT NULL,
	`day` varchar(15) NOT NULL,
	`startTime` varchar(10) NOT NULL,
	`endTime` varchar(10) NOT NULL,
	`grade` varchar(30) NOT NULL,
	`learningArea` varchar(100) NOT NULL,
	`teacherName` varchar(160) NOT NULL,
	CONSTRAINT `timetable_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('super_admin','admin','teacher','class_teacher','finance','storekeeper','staff','user') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `users` ADD `username` varchar(80);--> statement-breakpoint
ALTER TABLE `users` ADD `active` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_username_unique` UNIQUE(`username`);