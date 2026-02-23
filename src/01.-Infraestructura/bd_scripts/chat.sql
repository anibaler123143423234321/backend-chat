create table chat_users
(
    id              int auto_increment
        primary key,
    username        varchar(255)                             not null,
    nombre          varchar(255)                             null,
    apellido        varchar(255)                             null,
    email           varchar(255)                             null,
    currentRoomCode varchar(255)                             null,
    createdAt       datetime(6) default CURRENT_TIMESTAMP(6) not null,
    updatedAt       datetime(6) default CURRENT_TIMESTAMP(6) not null on update CURRENT_TIMESTAMP(6),
    role            varchar(255)                             null,
    numeroAgente    varchar(255)                             null,
    picture         text                                     null,
    constraint IDX_feccfaa7d08aa057668c7c4e9a
        unique (username)
);

create index IDX_users_email
    on chat_users (email);

create index IDX_users_numeroAgente
    on chat_users (numeroAgente);

create index IDX_users_role
    on chat_users (role);

create table conversation_favorites
(
    id             int auto_increment
        primary key,
    username       varchar(255)                             not null,
    conversationId int                                      not null,
    isPinned       tinyint     default 1                    not null,
    createdAt      datetime(6) default CURRENT_TIMESTAMP(6) not null,
    updatedAt      datetime(6) default CURRENT_TIMESTAMP(6) not null on update CURRENT_TIMESTAMP(6),
    constraint IDX_eed2d7f1962f216760504b7949
        unique (username, conversationId)
);

create index IDX_conv_favorites_conversationId
    on conversation_favorites (conversationId);

create index IDX_conv_favorites_isPinned
    on conversation_favorites (isPinned);

create index IDX_conv_favorites_username
    on conversation_favorites (username);

create table recent_searches
(
    id              int auto_increment
        primary key,
    username        varchar(255)                                                             not null,
    searchTerm      varchar(500)                                                             not null,
    searchType      enum ('user', 'room', 'message', 'general') default 'general'            not null,
    resultCount     int                                         default 0                    not null,
    clickedResultId varchar(255)                                                             null,
    createdAt       datetime(6)                                 default CURRENT_TIMESTAMP(6) not null,
    updatedAt       datetime(6)                                 default CURRENT_TIMESTAMP(6) not null on update CURRENT_TIMESTAMP(6)
)
    collate = utf8mb4_unicode_ci;

create table room_favorites
(
    id        int auto_increment
        primary key,
    username  varchar(255)                             not null,
    roomCode  varchar(50)                              not null,
    roomId    int                                      not null,
    isPinned  tinyint     default 1                    not null,
    createdAt datetime(6) default CURRENT_TIMESTAMP(6) not null,
    updatedAt datetime(6) default CURRENT_TIMESTAMP(6) not null on update CURRENT_TIMESTAMP(6),
    constraint IDX_e95a9315f2643d011f1a505cd0
        unique (username, roomCode)
);

create index IDX_room_favorites_isPinned
    on room_favorites (isPinned);

create index IDX_room_favorites_roomCode
    on room_favorites (roomCode);

create index IDX_room_favorites_roomId
    on room_favorites (roomId);

create index IDX_room_favorites_username
    on room_favorites (username);

create table system_config
(
    id          int auto_increment
        primary key,
    `key`       varchar(100)                             not null,
    value       text                                     not null,
    description varchar(255)                             null,
    type        varchar(50) default 'string'             not null,
    isActive    tinyint     default 1                    not null,
    createdAt   datetime(6) default CURRENT_TIMESTAMP(6) not null,
    updatedAt   datetime(6) default CURRENT_TIMESTAMP(6) not null on update CURRENT_TIMESTAMP(6),
    constraint IDX_eedd3cd0f227c7fb5eff2204e9
        unique (`key`)
);

create table temporary_conversations
(
    id                  int auto_increment
        primary key,
    name                varchar(255)                             not null,
    description         varchar(500)                             null,
    linkId              varchar(50)                              not null,
    maxParticipants     int         default 0                    not null,
    currentParticipants int         default 0                    not null,
    isActive            tinyint     default 1                    not null,
    participants        json                                     null,
    isAssignedByAdmin   tinyint     default 0                    not null,
    assignedUsers       json                                     null,
    settings            json                                     null,
    createdBy           int                                      not null,
    createdAt           datetime(6) default CURRENT_TIMESTAMP(6) not null,
    updatedAt           datetime(6) default CURRENT_TIMESTAMP(6) not null on update CURRENT_TIMESTAMP(6),
    pendingParticipants json                                     null,
    constraint IDX_dc1da0da5787b0ab9b762244cb
        unique (linkId)
);

create index IDX_temp_conv_active_assigned
    on temporary_conversations (isActive, isAssignedByAdmin);

create index IDX_temp_conv_createdBy
    on temporary_conversations (createdBy);

create index IDX_temp_conv_isActive
    on temporary_conversations (isActive);

create index IDX_temp_conv_isAssignedByAdmin
    on temporary_conversations (isAssignedByAdmin);

create index IDX_temp_conv_linkId
    on temporary_conversations (linkId);

create table temporary_rooms
(
    id                int auto_increment
        primary key,
    name              varchar(255)                             not null,
    description       varchar(500)                             null,
    roomCode          varchar(50)                              not null,
    maxCapacity       int         default 50                   not null,
    currentMembers    int         default 0                    not null,
    isActive          tinyint     default 1                    not null,
    members           json                                     null,
    assignedMembers   json                                     null,
    isAssignedByAdmin tinyint     default 0                    not null,
    settings          json                                     null,
    createdBy         int                                      not null,
    createdAt         datetime(6) default CURRENT_TIMESTAMP(6) not null,
    updatedAt         datetime(6) default CURRENT_TIMESTAMP(6) not null on update CURRENT_TIMESTAMP(6),
    connectedMembers  json                                     null,
    pinnedMessageId   int                                      null,
    pendingMembers    json                                     null,
    constraint IDX_385391ea091e920dc8f4142989
        unique (roomCode)
);

create table messages
(
    id                        int auto_increment
        primary key,
    `from`                    varchar(255)                             not null,
    fromId                    int                                      null,
    `to`                      varchar(255)                             null,
    message                   text                                     null,
    isGroup                   tinyint     default 0                    not null,
    groupName                 varchar(50)                              null,
    roomCode                  varchar(50)                              null,
    mediaType                 varchar(20)                              null,
    mediaData                 longtext                                 null,
    fileName                  varchar(255)                             null,
    fileSize                  int                                      null,
    sentAt                    datetime                                 not null,
    isRead                    tinyint     default 0                    not null,
    readBy                    json                                     null,
    isDeleted                 tinyint     default 0                    not null,
    deletedAt                 datetime                                 null,
    isEdited                  tinyint     default 0                    not null,
    editedAt                  datetime                                 null,
    time                      varchar(20)                              null,
    roomId                    int                                      null,
    createdAt                 datetime(6) default CURRENT_TIMESTAMP(6) not null,
    updatedAt                 datetime(6) default CURRENT_TIMESTAMP(6) not null on update CURRENT_TIMESTAMP(6),
    replyToMessageId          int                                      null,
    replyToSender             varchar(255)                             null,
    replyToText               text                                     null,
    readAt                    datetime                                 null,
    reactions                 json                                     null,
    threadId                  int                                      null,
    threadCount               int         default 0                    not null,
    lastReplyFrom             varchar(255)                             null,
    senderRole                varchar(50)                              null,
    senderNumeroAgente        varchar(20)                              null,
    deletedBy                 varchar(255)                             null,
    replyToSenderNumeroAgente varchar(20)                              null,
    type                      varchar(50)                              null,
    videoCallUrl              varchar(500)                             null,
    videoRoomID               varchar(100)                             null,
    metadata                  json                                     null,
    conversationId            int                                      null,
    isForwarded               tinyint     default 0                    not null,
    replyToAttachmentId       int                                      null,
    constraint FK_aaa8a6effc7bd20a1172d3a3bc8
        foreign key (roomId) references temporary_rooms (id)
);

create table message_attachments
(
    id            int auto_increment
        primary key,
    url           longtext                                 not null,
    type          varchar(50)                              null,
    fileName      varchar(255)                             null,
    fileSize      int                                      null,
    messageId     int                                      not null,
    createdAt     datetime(6) default CURRENT_TIMESTAMP(6) not null,
    threadCount   int         default 0                    not null,
    lastReplyFrom varchar(255)                             null,
    lastReplyAt   datetime                                 null,
    constraint FK_5b4f24737fcb6b35ffdd4d16e13
        foreign key (messageId) references messages (id)
            on delete cascade
);

create index IDX_messages_conv_deleted_sentAt
    on messages (conversationId asc, isDeleted asc, sentAt desc);

create index IDX_messages_conv_thread_deleted
    on messages (conversationId, threadId, isDeleted);

create index IDX_messages_conversationId
    on messages (conversationId);

create index IDX_messages_from_to_group
    on messages (`from`, `to`, isGroup);

create index IDX_messages_isDeleted
    on messages (isDeleted);

create index IDX_messages_isGroup
    on messages (isGroup);

create index IDX_messages_roomCode
    on messages (roomCode);

create index IDX_messages_room_deleted_sentAt
    on messages (roomCode asc, isDeleted asc, sentAt desc);

create index IDX_messages_room_thread_deleted
    on messages (roomCode, threadId, isDeleted);

create index IDX_messages_sentAt
    on messages (sentAt);

create index IDX_messages_threadId
    on messages (threadId);

create table polls
(
    id                 int auto_increment
        primary key,
    question           varchar(500)                             not null,
    createdBy          varchar(255)                             not null,
    allowMultipleVotes tinyint     default 0                    not null,
    expiresAt          datetime                                 null,
    messageId          int                                      not null,
    createdAt          datetime(6) default CURRENT_TIMESTAMP(6) not null,
    updatedAt          datetime(6) default CURRENT_TIMESTAMP(6) not null on update CURRENT_TIMESTAMP(6),
    constraint REL_a98d3cf1094db401a5d1ef290c
        unique (messageId),
    constraint FK_a98d3cf1094db401a5d1ef290cd
        foreign key (messageId) references messages (id)
            on delete cascade
);

create table poll_options
(
    id         int auto_increment
        primary key,
    text       varchar(255)  not null,
    votesCount int default 0 not null,
    pollId     int           not null,
    constraint FK_4edaafa5d0ea2a447af004706a4
        foreign key (pollId) references polls (id)
            on delete cascade
);

create table poll_votes
(
    id       int auto_increment
        primary key,
    username varchar(255)                             not null,
    optionId int                                      not null,
    pollId   int                                      not null,
    votedAt  datetime(6) default CURRENT_TIMESTAMP(6) not null,
    constraint FK_126dde5dfb2f0bafcd65ea27dc5
        foreign key (pollId) references polls (id)
            on delete cascade,
    constraint FK_f33fc76e575b7a703a67868b1dc
        foreign key (optionId) references poll_options (id)
            on delete cascade
);

create index IDX_temp_rooms_active_assigned
    on temporary_rooms (isActive, isAssignedByAdmin);

create index IDX_temp_rooms_createdBy
    on temporary_rooms (createdBy);

create index IDX_temp_rooms_isActive
    on temporary_rooms (isActive);

create index IDX_temp_rooms_isAssignedByAdmin
    on temporary_rooms (isAssignedByAdmin);

create index IDX_temp_rooms_roomCode
    on temporary_rooms (roomCode);

