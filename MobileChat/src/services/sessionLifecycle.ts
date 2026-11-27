type SessionInvalidator = () => void;

let socketSessionInvalidator: SessionInvalidator | null = null;

export const registerSocketSessionInvalidator = (invalidate: SessionInvalidator) => {
  socketSessionInvalidator = invalidate;
};

export const invalidateSocketSession = () => {
  socketSessionInvalidator?.();
};
