CREATE TABLE `role_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`role` varchar(40) NOT NULL,
	`permissionKey` varchar(120) NOT NULL,
	`allowed` int NOT NULL DEFAULT 1,
	CONSTRAINT `role_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `role_permission_unique` UNIQUE(`role`,`permissionKey`)
);
--> statement-breakpoint
ALTER TABLE `staff_profiles` ADD `staffId` varchar(40);--> statement-breakpoint
ALTER TABLE `staff_profiles` ADD `department` varchar(120);--> statement-breakpoint
INSERT IGNORE INTO `role_permissions` (`role`,`permissionKey`,`allowed`) VALUES
('super_admin','*',1),('super_admin','administration.manage_permissions',1),
('admin','dashboard.view',1),('admin','learners.view',1),('admin','learners.add',1),('admin','learners.edit',1),('admin','learners.deactivate',1),('admin','attendance.view',1),('admin','attendance.edit',1),('admin','assessments.view',1),('admin','assessments.edit',1),('admin','reports.view',1),('admin','finance.view',1),('admin','finance.edit',1),('admin','store.view',1),('admin','store.edit',1),('admin','timetable.view',1),('admin','timetable.edit',1),('admin','communication.edit',1),('admin','alumni.edit',1),('admin','users.edit',1),('admin','settings.edit',1),('admin','audit.view',1),('admin','allocations.view',1),('admin','allocations.create',1),('admin','allocations.edit',1),('admin','allocations.deactivate',1),('admin','allocations.replace',1),('admin','allocations.bulk',1),('admin','administration.view',1),('admin','administration.create',1),('admin','administration.edit',1),
('teacher','dashboard.view',1),('teacher','learners.view',1),('teacher','attendance.view',1),('teacher','attendance.edit',1),('teacher','assessments.view',1),('teacher','assessments.edit',1),('teacher','reports.view',1),('teacher','timetable.view',1),('teacher','allocations.view',1),
('class_teacher','dashboard.view',1),('class_teacher','learners.view',1),('class_teacher','attendance.view',1),('class_teacher','attendance.edit',1),('class_teacher','assessments.view',1),('class_teacher','assessments.edit',1),('class_teacher','reports.view',1),('class_teacher','timetable.view',1),('class_teacher','allocations.view',1),
('finance','dashboard.view',1),('finance','learners.view',1),('finance','finance.view',1),('finance','finance.edit',1),('finance','reports.view',1),
('storekeeper','dashboard.view',1),('storekeeper','store.view',1),('storekeeper','store.edit',1),('storekeeper','reports.view',1),
('other','dashboard.view',1);
