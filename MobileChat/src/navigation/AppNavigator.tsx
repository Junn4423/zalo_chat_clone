import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Alert, Linking, View} from 'react-native';
import {createNavigationContainerRef, NavigationContainer} from '@react-navigation/native';
import AuthStack from './AuthStack';
import MainTabs from './MainTabs';
import {getToken, removeToken} from '../auth/utils/storage';
import {useAuthStore} from '../auth/store/login.store';
import {InviteTarget, parseInviteLink} from '../utils/friendInvite';
import {joinGroupByInvite} from '../services/ChatAPI/api';

const navigationRef = createNavigationContainerRef<any>();

export default function AppNavigator() {
  const [sessionReady, setSessionReady] = useState(false);
  const [navigationReady, setNavigationReady] = useState(false);
  const [pendingInvite, setPendingInvite] = useState<InviteTarget | null>(null);
  const auth = useAuthStore(state => state.auth);

  const openInvite = useCallback(async (invite: InviteTarget) => {
    if (!navigationRef.isReady()) return;
    if (invite.type === 'friend') {
      navigationRef.navigate('Directory', {openTab: 'discover', searchUsername: invite.username});
      return;
    }
    try {
      const room = await joinGroupByInvite(invite.token);
      navigationRef.navigate('ChatList', {screen: 'ChatDetail', params: {chatId: room.roomId, chatType: 'group', chatName: room.name}});
    } catch (error: any) {
      Alert.alert('Không vào được nhóm', error?.response?.data?.error || error?.message || 'Liên kết mời có thể đã hết hạn.');
    }
  }, []);

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      try {
        const token = await getToken();
        const persistedAuth = useAuthStore.getState().auth;

        // The token and the persisted user session are written separately. Only
        // restore when both still describe the same login.
        if (!token || !persistedAuth?.token || token !== persistedAuth.token) {
          useAuthStore.getState().logout();
          if (token) {
            await removeToken();
          }
        }
      } catch (error) {
        useAuthStore.getState().logout();
        try {
          await removeToken();
        } catch (storageError) {
          console.warn('Unable to clear stale login token', storageError);
        }
        console.warn('Unable to restore login session', error);
      } finally {
        if (active) {
          setSessionReady(true);
        }
      }
    };

    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleInvite = (url?: string | null) => {
      const invite = parseInviteLink(url);
      if (!invite) return;
      if (navigationReady && useAuthStore.getState().auth?.token) {
        void openInvite(invite);
      } else {
        setPendingInvite(invite);
      }
    };
    const subscription = Linking.addEventListener('url', event => handleInvite(event.url));
    void Linking.getInitialURL().then(handleInvite).catch(() => undefined);
    return () => subscription.remove();
  }, [navigationReady, openInvite]);

  useEffect(() => {
    if (!sessionReady || !navigationReady || !auth?.token || !pendingInvite) return;
    void openInvite(pendingInvite);
    setPendingInvite(null);
  }, [auth?.token, navigationReady, openInvite, pendingInvite, sessionReady]);

  return (
    <NavigationContainer ref={navigationRef} onReady={() => setNavigationReady(true)}>
      {!sessionReady ? (
        <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
          <ActivityIndicator color="#1683ed" />
        </View>
      ) : auth?.token ? (
        <MainTabs onLogout={() => useAuthStore.getState().logout()} />
      ) : (
        <AuthStack onLogin={() => undefined} />
      )}
    </NavigationContainer>
  );
}
