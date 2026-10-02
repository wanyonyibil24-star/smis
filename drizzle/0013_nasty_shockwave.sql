ALTER TABLE `learners` MODIFY COLUMN `status` enum('active','inactive','archived') NOT NULL DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `guardians` ADD `idNumber` varchar(40);--> statement-breakpoint
ALTER TABLE `learners` ADD `guardianIdNumber` varchar(40);--> statement-breakpoint
ALTER TABLE `staff_profiles` ADD `title` varchar(30);--> statement-breakpoint
ALTER TABLE `staff_profiles` ADD `email` varchar(320);