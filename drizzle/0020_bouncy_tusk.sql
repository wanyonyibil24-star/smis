CREATE TABLE `library_books` (
	`id` int AUTO_INCREMENT NOT NULL,
	`isbn` varchar(40),
	`title` varchar(200) NOT NULL,
	`author` varchar(160),
	`publisher` varchar(160),
	`pubYear` int,
	`subject` varchar(120),
	`categoryId` int,
	`deletedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `library_books_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `library_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`active` int NOT NULL DEFAULT 1,
	CONSTRAINT `library_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `library_categories_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `library_copies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookId` int NOT NULL,
	`accessionNo` varchar(80) NOT NULL,
	`barcode` varchar(80) NOT NULL,
	`status` enum('available','borrowed','lost','damaged','withdrawn') NOT NULL DEFAULT 'available',
	`location` varchar(120),
	`condition` varchar(40) NOT NULL DEFAULT 'good',
	`acquiredOn` date,
	`cost` decimal(12,2),
	CONSTRAINT `library_copies_id` PRIMARY KEY(`id`),
	CONSTRAINT `library_copies_accessionNo_unique` UNIQUE(`accessionNo`),
	CONSTRAINT `library_copies_barcode_unique` UNIQUE(`barcode`)
);
--> statement-breakpoint
CREATE TABLE `library_fines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`loanId` bigint NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`paid` decimal(12,2) NOT NULL DEFAULT '0',
	`reason` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `library_fines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `library_loans` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`copyId` int NOT NULL,
	`learnerId` int,
	`staffUserId` int,
	`loanedOn` date NOT NULL,
	`dueDate` date NOT NULL,
	`returnedOn` date,
	`renewedCount` int NOT NULL DEFAULT 0,
	`issuedByUserId` int NOT NULL,
	CONSTRAINT `library_loans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `library_reservations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookId` int NOT NULL,
	`learnerId` int,
	`staffUserId` int,
	`status` enum('waiting','ready','fulfilled','cancelled') NOT NULL DEFAULT 'waiting',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `library_reservations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_clockings` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`clockDate` date NOT NULL,
	`clockedAt` timestamp NOT NULL DEFAULT (now()),
	`latitude` decimal(10,7) NOT NULL,
	`longitude` decimal(10,7) NOT NULL,
	`distanceMeters` decimal(10,2) NOT NULL,
	CONSTRAINT `staff_clockings_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_clocking_daily_unique` UNIQUE(`userId`,`clockDate`)
);
--> statement-breakpoint
ALTER TABLE `school_settings` ADD `latitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `school_settings` ADD `longitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `school_settings` ADD `geofenceRadiusMeters` int DEFAULT 150 NOT NULL;

--> statement-breakpoint
INSERT IGNORE INTO `role_permissions` (`role`,`permissionKey`,`allowed`) VALUES
('admin','library.view',1),('admin','library.create',1),('admin','library.edit',1),
('teacher','library.view',1),('teacher','library.edit',1),
('class_teacher','library.view',1),('class_teacher','library.edit',1),
('finance','library.view',1),('storekeeper','library.view',1);
