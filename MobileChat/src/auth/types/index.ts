export type loginData = {
  username: string;
  password: string;
};
export type loginResponse = {
  message: string;
  user: {
    id: string;
    username: string;
    name: string;
    avatar?: string;
  };
  token: string;
};
