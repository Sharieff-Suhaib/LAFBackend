-- CreateTable
CREATE TABLE "ItemReceived" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "item_name" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemReceived_pkey" PRIMARY KEY ("id")
);
