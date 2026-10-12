CREATE TABLE `curriculum_offerings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`level` varchar(40) NOT NULL,
	`gradeLabel` varchar(40) NOT NULL,
	`pathway` varchar(100),
	`learningArea` varchar(160) NOT NULL,
	`subjectCode` varchar(40),
	`offered` int NOT NULL DEFAULT 1,
	`sourceUrl` varchar(500),
	`updatedByUserId` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `curriculum_offerings_id` PRIMARY KEY(`id`),
	CONSTRAINT `curriculum_offering_unique` UNIQUE(`level`,`gradeLabel`,`pathway`,`learningArea`)
);
--> statement-breakpoint
CREATE TABLE `nexus_message_recipients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` int NOT NULL,
	`recipientType` varchar(30) NOT NULL,
	`recipientId` int NOT NULL,
	`label` varchar(180) NOT NULL,
	`status` enum('queued','sent','failed') NOT NULL DEFAULT 'queued',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `nexus_message_recipients_id` PRIMARY KEY(`id`),
	CONSTRAINT `nexus_message_recipient_unique` UNIQUE(`messageId`,`recipientType`,`recipientId`)
);
--> statement-breakpoint
CREATE TABLE `nexus_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category` varchar(80) NOT NULL DEFAULT 'announcement',
	`channel` enum('sms','email','in_app','whatsapp') NOT NULL DEFAULT 'in_app',
	`body` text NOT NULL,
	`status` enum('draft','queued','sent','failed','cancelled') NOT NULL DEFAULT 'queued',
	`selectionJson` text,
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `nexus_messages_id` PRIMARY KEY(`id`)
);
