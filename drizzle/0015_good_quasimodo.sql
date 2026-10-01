ALTER TABLE `report_cards` DROP INDEX `report_card_period_unique`;--> statement-breakpoint
UPDATE `assessments` SET `status` = 'draft' WHERE `status` NOT IN ('draft','submitted','approved','locked');--> statement-breakpoint
ALTER TABLE `assessments` MODIFY COLUMN `status` enum('draft','submitted','approved','locked') NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `marks` MODIFY COLUMN `midTerm` decimal(5,2);--> statement-breakpoint
ALTER TABLE `marks` MODIFY COLUMN `endTerm` decimal(5,2);--> statement-breakpoint
ALTER TABLE `marks` MODIFY COLUMN `average` decimal(5,2);--> statement-breakpoint
ALTER TABLE `marks` MODIFY COLUMN `cbcLevel` enum('EE1','EE2','ME1','ME2','AE1','AE2','BE1','BE2');--> statement-breakpoint
ALTER TABLE `assessments` ADD `subjectId` int NULL;--> statement-breakpoint
ALTER TABLE `assessments` ADD `teacherUserId` int NULL;--> statement-breakpoint
ALTER TABLE `assessments` ADD `assessmentType` enum('mid_term','end_term') DEFAULT 'end_term' NOT NULL;--> statement-breakpoint
ALTER TABLE `assessments` ADD `submittedAt` timestamp NULL;--> statement-breakpoint
ALTER TABLE `assessments` ADD `verifiedByUserId` int NULL;--> statement-breakpoint
ALTER TABLE `assessments` ADD `verifiedAt` timestamp NULL;--> statement-breakpoint
ALTER TABLE `assessments` ADD `lockedAt` timestamp NULL;--> statement-breakpoint
ALTER TABLE `assessments` ADD `createdAt` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `assessments` ADD `updatedAt` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `marks` ADD `score` decimal(5,2) NULL;--> statement-breakpoint
ALTER TABLE `marks` ADD `updatedByUserId` int NULL;--> statement-breakpoint
ALTER TABLE `marks` ADD `updatedAt` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `report_cards` ADD `assessmentType` enum('mid_term','end_term') DEFAULT 'end_term' NOT NULL;--> statement-breakpoint
UPDATE `assessments` a SET `subjectId` = COALESCE((SELECT m.`subjectId` FROM `marks` m WHERE m.`assessmentId` = a.`id` ORDER BY m.`id` LIMIT 1),(SELECT s.`id` FROM `subjects` s ORDER BY s.`id` LIMIT 1),1), `teacherUserId` = COALESCE((SELECT t.`teacherUserId` FROM `teacher_allocations` t WHERE t.`gradeId` = a.`gradeId` AND t.`academicYear` = a.`academicYear` AND t.`term` = a.`term` AND t.`status` = 'active' ORDER BY t.`id` LIMIT 1),(SELECT u.`id` FROM `users` u ORDER BY u.`id` LIMIT 1),1);--> statement-breakpoint
ALTER TABLE `assessments` MODIFY COLUMN `subjectId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `assessments` MODIFY COLUMN `teacherUserId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `assessments` ADD CONSTRAINT `assessment_scope_unique` UNIQUE(`academicYear`,`term`,`assessmentType`,`gradeId`,`subjectId`,`teacherUserId`);--> statement-breakpoint
ALTER TABLE `report_cards` ADD CONSTRAINT `report_card_period_unique` UNIQUE(`learnerId`,`academicYear`,`term`,`assessmentType`);
