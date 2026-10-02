CREATE TABLE `timetable_requirements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gradeId` int NOT NULL,
	`subjectId` int NOT NULL,
	`academicYear` int NOT NULL,
	`periodsPerWeek` int NOT NULL,
	CONSTRAINT `timetable_requirements_id` PRIMARY KEY(`id`),
	CONSTRAINT `timetable_requirement_unique` UNIQUE(`gradeId`,`subjectId`,`academicYear`)
);
