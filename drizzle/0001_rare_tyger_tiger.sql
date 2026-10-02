CREATE TABLE `alumni` (
	`id` int AUTO_INCREMENT NOT NULL,
	`learnerId` int NOT NULL,
	`completionYear` int NOT NULL,
	`destination` varchar(160),
	`archivedAt` timestamp NOT NULL DEFAULT (now()),
	`archivedByUserId` int NOT NULL,
	CONSTRAINT `alumni_id` PRIMARY KEY(`id`),
	CONSTRAINT `alumni_learnerId_unique` UNIQUE(`learnerId`)
);
--> statement-breakpoint
CREATE TABLE `assessments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(120) NOT NULL,
	`term` varchar(40) NOT NULL,
	`academicYear` int NOT NULL,
	`gradeId` int NOT NULL,
	`status` enum('draft','open','locked','approved') NOT NULL DEFAULT 'open',
	CONSTRAINT `assessments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `attendances` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`learnerId` int NOT NULL,
	`gradeId` int NOT NULL,
	`attendanceDate` date NOT NULL,
	`status` enum('present','absent','late','excused') NOT NULL,
	`note` varchar(255),
	CONSTRAINT `attendances_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `smis_audit_logs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int,
	`action` varchar(120) NOT NULL,
	`entityType` varchar(80),
	`entityId` varchar(80),
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `smis_audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `communications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`audience` enum('parents','staff','learners','all') NOT NULL,
	`channel` enum('sms','notice','email') NOT NULL,
	`subject` varchar(160) NOT NULL,
	`body` text NOT NULL,
	`status` enum('draft','queued','sent','failed') NOT NULL DEFAULT 'draft',
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `communications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fee_structures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gradeId` int NOT NULL,
	`term` varchar(40) NOT NULL,
	`academicYear` int NOT NULL,
	`itemName` varchar(120) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	CONSTRAINT `fee_structures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `grades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`stream` varchar(80),
	`classTeacherUserId` int,
	CONSTRAINT `grades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `learners` (
	`id` int AUTO_INCREMENT NOT NULL,
	`admissionNumber` varchar(40) NOT NULL,
	`fullName` varchar(160) NOT NULL,
	`guardianName` varchar(160),
	`guardianPhone` varchar(40),
	`gradeId` int NOT NULL,
	`status` enum('active','archived') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `learners_id` PRIMARY KEY(`id`),
	CONSTRAINT `learners_admissionNumber_unique` UNIQUE(`admissionNumber`)
);
--> statement-breakpoint
CREATE TABLE `marks` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`assessmentId` int NOT NULL,
	`learnerId` int NOT NULL,
	`subjectId` int NOT NULL,
	`midTerm` decimal(5,2) NOT NULL,
	`endTerm` decimal(5,2) NOT NULL,
	`average` decimal(5,2) NOT NULL,
	`cbcLevel` enum('EE1','EE2','ME1','ME2','AE1','AE2','BE1','BE2') NOT NULL,
	`teacherRemark` varchar(255),
	CONSTRAINT `marks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`learnerId` int NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`paymentMethod` enum('mpesa','bank','cash') NOT NULL,
	`reference` varchar(80) NOT NULL,
	`paidAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `school_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`schoolName` varchar(200) NOT NULL,
	`motto` varchar(255),
	`currentTerm` varchar(40) NOT NULL,
	`academicYear` int NOT NULL,
	`includeFeesOnReportCard` int NOT NULL DEFAULT 1,
	`logoPath` varchar(255),
	`principalSignaturePath` varchar(255),
	`classTeacherSignaturePath` varchar(255),
	CONSTRAINT `school_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`displayName` varchar(160) NOT NULL,
	`phone` varchar(40),
	`role` enum('super_admin','admin','teacher','finance','storekeeper','other') NOT NULL DEFAULT 'other',
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `staff_profiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `store_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`unit` varchar(30) NOT NULL,
	`reorderLevel` decimal(12,2) NOT NULL DEFAULT '0',
	CONSTRAINT `store_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `store_movements` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`itemId` int NOT NULL,
	`movementType` enum('received','issued','adjustment') NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`reference` varchar(120),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `store_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`code` varchar(30) NOT NULL,
	CONSTRAINT `subjects_id` PRIMARY KEY(`id`),
	CONSTRAINT `subjects_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `teacher_allocations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`teacherUserId` int NOT NULL,
	`gradeId` int NOT NULL,
	`subjectId` int NOT NULL,
	`academicYear` int NOT NULL,
	CONSTRAINT `teacher_allocations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `timetable_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gradeId` int NOT NULL,
	`subjectId` int NOT NULL,
	`teacherUserId` int NOT NULL,
	`dayOfWeek` int NOT NULL,
	`period` int NOT NULL,
	`room` varchar(80),
	CONSTRAINT `timetable_entries_id` PRIMARY KEY(`id`)
);
