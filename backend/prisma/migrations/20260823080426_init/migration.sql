-- CreateTable
CREATE TABLE "ServiceCredential" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "service" TEXT NOT NULL,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" DATETIME,
    "kitsuUsernameEnc" TEXT,
    "kitsuPasswordEnc" TEXT,
    "kitsuUserId" TEXT,
    "malUsername" TEXT,
    "codeVerifier" TEXT,
    "oauthState" TEXT,
    "connectedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MediaMapping" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "malId" INTEGER NOT NULL,
    "mediaType" TEXT NOT NULL,
    "anilistId" INTEGER,
    "anilistLookupAt" DATETIME,
    "kitsuId" TEXT,
    "kitsuLookupAt" DATETIME
);

-- CreateTable
CREATE TABLE "ListEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "malId" INTEGER NOT NULL,
    "mediaType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "progress" INTEGER NOT NULL,
    "volumesProgress" INTEGER,
    "startDate" TEXT,
    "finishDate" TEXT,
    "malUpdatedAt" DATETIME NOT NULL,
    "anilistSyncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "anilistSyncedAt" DATETIME,
    "anilistLastError" TEXT,
    "anilistListEntryId" TEXT,
    "kitsuSyncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "kitsuSyncedAt" DATETIME,
    "kitsuLastError" TEXT,
    "kitsuLibraryEntryId" TEXT
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trigger" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "animeCount" INTEGER NOT NULL DEFAULT 0,
    "mangaCount" INTEGER NOT NULL DEFAULT 0,
    "pushedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT
);

-- CreateTable
CREATE TABLE "SyncRunEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "syncRunId" INTEGER NOT NULL,
    "malId" INTEGER NOT NULL,
    "mediaType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncRunEntry_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "lastFullSyncAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCredential_service_key" ON "ServiceCredential"("service");

-- CreateIndex
CREATE UNIQUE INDEX "MediaMapping_malId_mediaType_key" ON "MediaMapping"("malId", "mediaType");

-- CreateIndex
CREATE UNIQUE INDEX "ListEntry_malId_mediaType_key" ON "ListEntry"("malId", "mediaType");
