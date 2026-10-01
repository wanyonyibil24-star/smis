CREATE TABLE `iam_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sessionHash` varchar(128) NOT NULL,
	`loginAt` timestamp NOT NULL DEFAULT (now()),
	`logoutAt` timestamp,
	`ipAddress` varchar(80),
	`userAgent` varchar(500),
	`status` enum('active','revoked','expired') NOT NULL DEFAULT 'active',
	CONSTRAINT `iam_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `iam_sessions_sessionHash_unique` UNIQUE(`sessionHash`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `username` varchar(120);--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `accountStatus` enum('active','disabled','locked','pending_activation') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `failedLoginAttempts` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `accountLocked` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `mustChangePassword` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `passwordChangedAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_username_unique` UNIQUE(`username`);