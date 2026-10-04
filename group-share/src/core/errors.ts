export class GroupShareError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GroupShareError";
    this.code = code;
  }
}

export class EmptyInviteListError extends GroupShareError {
  constructor() {
    super("EMPTY_INVITE_LIST", "A group needs at least one invite before a share can be minted.");
    this.name = "EmptyInviteListError";
  }
}

export class EmptyCidrListError extends GroupShareError {
  constructor() {
    super("EMPTY_CIDR_LIST", "A group needs at least one CIDR before a share can be minted.");
    this.name = "EmptyCidrListError";
  }
}

export class GroupNotFoundError extends GroupShareError {
  constructor(groupId: string) {
    super("GROUP_NOT_FOUND", `Group ${groupId} does not exist.`);
    this.name = "GroupNotFoundError";
  }
}

export class InvalidOriginError extends GroupShareError {
  constructor(originUrl: string) {
    super("INVALID_ORIGIN", `Origin is not an http(s) URL: ${originUrl}`);
    this.name = "InvalidOriginError";
  }
}

export class InvalidCidrError extends GroupShareError {
  constructor(cidr: string) {
    super("INVALID_CIDR", `Not a CIDR or IP: ${cidr}`);
    this.name = "InvalidCidrError";
  }
}

export class ShareNotFoundError extends GroupShareError {
  constructor(label: string) {
    super("SHARE_NOT_FOUND", `Share ${label} does not exist.`);
    this.name = "ShareNotFoundError";
  }
}
