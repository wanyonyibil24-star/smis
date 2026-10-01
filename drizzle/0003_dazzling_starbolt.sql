ALTER TABLE `attendances` ADD CONSTRAINT `attendance_unique` UNIQUE(`learnerId`,`attendanceDate`);--> statement-breakpoint
ALTER TABLE `learner_guardians` ADD CONSTRAINT `learner_guardian_unique` UNIQUE(`learnerId`,`guardianId`);--> statement-breakpoint
ALTER TABLE `marks` ADD CONSTRAINT `mark_unique` UNIQUE(`assessmentId`,`learnerId`,`subjectId`);--> statement-breakpoint
ALTER TABLE `teacher_allocations` ADD CONSTRAINT `teacher_allocation_unique` UNIQUE(`teacherUserId`,`gradeId`,`subjectId`,`academicYear`);--> statement-breakpoint
ALTER TABLE `timetable_entries` ADD CONSTRAINT `timetable_grade_slot_unique` UNIQUE(`gradeId`,`dayOfWeek`,`period`);--> statement-breakpoint
ALTER TABLE `timetable_entries` ADD CONSTRAINT `timetable_teacher_slot_unique` UNIQUE(`teacherUserId`,`dayOfWeek`,`period`);