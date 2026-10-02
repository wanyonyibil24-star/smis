ALTER TABLE `assessments` DROP INDEX `assessment_scope_unique`;--> statement-breakpoint
ALTER TABLE `marks` ADD `teacherUserId` int NULL;--> statement-breakpoint
UPDATE `marks` m INNER JOIN `assessments` a ON a.`id` = m.`assessmentId` SET m.`teacherUserId` = a.`teacherUserId`;--> statement-breakpoint
ALTER TABLE `marks` MODIFY COLUMN `teacherUserId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `assessments` ADD CONSTRAINT `assessment_scope_unique` UNIQUE(`academicYear`,`term`,`assessmentType`,`gradeId`,`subjectId`);
