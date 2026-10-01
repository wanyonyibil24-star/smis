ALTER TABLE `staff_profiles` ADD `teacherCode` int;--> statement-breakpoint
ALTER TABLE `staff_profiles` ADD CONSTRAINT `staff_profiles_teacherCode_unique` UNIQUE(`teacherCode`);