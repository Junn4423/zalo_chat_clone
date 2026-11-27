import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../auth/screens/LoginScreen';
import { AuthStackParamList } from '../types/navigation';

type AuthStackProps = {
  onLogin: () => void;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export default function AuthStack({ onLogin }: AuthStackProps) {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="Login"
        options={{ headerShown: false }}
      >
        {(props) => <LoginScreen {...props} onLogin={onLogin} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
