export type AuthStackParamList = {
  Login: undefined;
};

export type MainTabsParamList = {
  ChatList: undefined;
  Directory: undefined;
  Calls: undefined;
  SearchMessages: {chatId: string; chatName?: string};
  ChatInfo: {chatId: string; chatName?: string; chatType?: string};
  SharedItems: {chatId: string; chatName?: string};
  ChatExport: {chatId: string; chatName?: string};
  HiddenChats: {setupOnly?: boolean} | undefined;
  ChatDetail: {
      chatId: string;
      chatType: string;
      chatName?: string;
      hiddenChatAccessToken?: string;
      startAudioCall?: number;
      startVideoCall?: number;
    };
  User: undefined;
  TaoNhom: undefined;
};
