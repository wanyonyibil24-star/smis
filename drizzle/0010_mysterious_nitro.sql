ALTER TABLE `teacher_allocations` DROP INDEX `teacher_allocation_unique`;--> statement-breakpoint
ALTER TABLE `teacher_allocations` ADD `term` varchar(40) DEFAULT 'Term 1' NOT NULL;--> statement-breakpoint
ALTER TABLE `teacher_allocations` ADD `allocationType` enum('class_teacher','learning_area','co_teacher','substitute','activity') DEFAULT 'learning_area' NOT NULL;--> statement-breakpoint
ALTER TABLE `teacher_allocations` ADD `status` enum('active','inactive','replaced') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `teacher_allocations` ADD `startsOn` date;--> statement-breakpoint
ALTER TABLE `teacher_allocations` ADD `endsOn` date;--> statement-breakpoint
ALTER TABLE `teacher_allocations` ADD `replacedByUserId` int;--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_allocation_scope_unique` ON `teacher_allocations` (`teacherUserId`,`gradeId`,`subjectId`,`academicYear`,`term`,`allocationType`);
