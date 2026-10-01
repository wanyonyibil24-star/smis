CREATE TABLE `iam_password_resets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `iam_password_resets_id` PRIMARY KEY(`id`),
	CONSTRAINT `iam_password_resets_tokenHash_unique` UNIQUE(`tokenHash`)
);
