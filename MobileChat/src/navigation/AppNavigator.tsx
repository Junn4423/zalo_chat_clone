import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Linking, View} from 'react-native';
import {createNavigationContainerRef, NavigationContainer} from '@react-navigation/native';
import AuthStack from './AuthStack';
import MainTabs from './MainTabs';
import {getToken, removeToken} from '../auth/utils/storage';
import {useAuthStore} from '../auth/store/login.store';
import {parseFriendInviteLink} from '../utils/friendInvite';

const navigationRef = createNavigationContainerRef<any>();

export default function AppNavigator() {
  const [sessionReady, setSessionReady] = useState(false);
  const [navigationReady, setNavigationReady] = useState(false);
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);
  const auth = useAuthStore(state => state.auth);

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
      const username = parseFriendInviteLink(url);
      if (!username) return;
      if (navigationReady && useAuthStore.getState().auth?.token) {
        navigationRef.navigate('Directory', {openTab: 'discover', searchUsername: username});
      } else {
        setPendingInvite(username);
      }
    };
    const subscription = Linking.addEventListener('url', event => handleInvite(event.url));
    void Linking.getInitialURL().then(handleInvite).catch(() => undefined);
    return () => subscription.remove();
  }, [navigationReady]);

  useEffect(() => {
    if (!sessionReady || !navigationReady || !auth?.token || !pendingInvite) return;
    navigationRef.navigate('Directory', {openTab: 'discover', searchUsername: pendingInvite});
    setPendingInvite(null);
  }, [auth?.token, navigationReady, pendingInvite, sessionReady]);

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
