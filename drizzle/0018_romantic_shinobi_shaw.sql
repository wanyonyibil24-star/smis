CREATE TABLE `attendance_register_approvals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`attendanceDate` date NOT NULL,
	`gradeId` int NOT NULL,
	`status` enum('draft','submitted','approved','reopened') NOT NULL DEFAULT 'draft',
	`submittedByUserId` int,
	`submittedAt` timestamp,
	`approvedByUserId` int,
	`approvedAt` timestamp,
	`notes` varchar(255),
	CONSTRAINT `attendance_register_approvals_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_register_approval_unique` UNIQUE(`attendanceDate`,`gradeId`)
);
--> statement-breakpoint
ALTER TABLE `attendances` DROP INDEX `attendance_unique`;--> statement-breakpoint
ALTER TABLE `attendances` ADD `session` enum('morning','afternoon') DEFAULT 'morning' NOT NULL;--> statement-breakpoint
ALTER TABLE `attendances` ADD CONSTRAINT `attendance_unique` UNIQUE(`learnerId`,`attendanceDate`,`session`);