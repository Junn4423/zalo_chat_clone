import React, { useEffect, useState } from "react"
import NotifyModal from "../../components/NotifyModal"
import { View, Text, TextInput, TouchableOpacity, SafeAreaView, KeyboardAvoidingView, Platform, ScrollView, Alert } from "react-native"
import Icon from 'react-native-vector-icons/FontAwesome';
import { Image } from 'react-native';
import { LoginStyles } from "./LoginScreen.styles"
import { loginAPI } from "../api/login.api"
import { getRememberedUsername, removeRememberedUsername, removeToken, setRememberedUsername, setToken } from "../utils/storage"
import { useAuthStore } from "../store/login.store"
import { connectSocket } from "../../utils/socket";

type LoginScreenProps = {
  onLogin: () => void;
}
const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [notify, setNotify] = useState({ visible: false, message: "", type: "error" })

  useEffect(() => {
    let active = true
    getRememberedUsername().then(username => {
      if (active && username) {
        setEmail(username)
        setRememberMe(true)
      }
    }).catch(error => console.warn('Không đọc được tài khoản đã lưu', error))
    return () => { active = false }
  }, [])

  const handleLogin = async () => {
    if (!email || !password) {
      setNotify({ visible: true, message: "Vui lòng nhập đầy đủ thông tin", type: "error" })
      return
    }
    setIsLoading(true)
    // Gọi API đăng nhập
    const result = await loginAPI(email, password)
    setIsLoading(false)
    if (result.token) {
      useAuthStore.getState().loginSuccess(result, rememberMe)
      //gọi tới hàm connect socket
      connectSocket(result.user.username, result.token)
      try {
        if (rememberMe) {
          await Promise.all([setToken(result.token), setRememberedUsername(result.user.username)])
        } else {
          await Promise.all([removeToken(), removeRememberedUsername()])
        }
      } catch (error) {
        console.warn('Không lưu được tùy chọn đăng nhập', error)
      }
      if (onLogin) onLogin()
    } else if (result.error) {
      setNotify({ visible: true, message: result.error, type: "error" })
    } else {
      setNotify({ visible: true, message: "Đăng nhập thất bại!", type: "error" })
    }
  }

  const handleSocialLogin = (provider: string) => {
    console.log(`Login with ${provider}`)
  }

  return (
    <SafeAreaView style={LoginStyles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={LoginStyles.keyboardView}>
        <ScrollView contentContainerStyle={LoginStyles.scrollContainer} showsVerticalScrollIndicator={false}>
          <View style={LoginStyles.logoContainer}>
              <Image source={require('../../assets/logo.png')} style={{ width: 100, height: 100,borderColor: '#4096f1ff', borderWidth: 1,borderRadius: 25, resizeMode: 'contain' }} />
          </View>

          <View style={LoginStyles.header}>
            <Text style={LoginStyles.title}>Chào mừng trở lại</Text>
            <Text style={LoginStyles.subtitle}>Đăng nhập để tiếp tục trò chuyện</Text>
          </View>

          {/* Login Form */}
          <View style={LoginStyles.formContainer}>
            {/* Tài khoản Input */}
            <View style={LoginStyles.inputContainer}>
              <Text style={LoginStyles.inputLabel}>Tài khoản</Text>
              <View style={LoginStyles.inputWrapper}>
                {/* Tài khoản Icon */}
                <Icon name="user-circle" size={20} color="#9CA3AF" />
                <TextInput
                  style={LoginStyles.textInput}
                  placeholder="Nhập tài khoản của bạn"
                  placeholderTextColor="#9CA3AF"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>

            {/* Password Input */}
            <View style={LoginStyles.inputContainer}>
              <Text style={LoginStyles.inputLabel}>Mật khẩu</Text>
              <View style={LoginStyles.inputWrapper}>
                {/* Lock Icon */}
                <Icon name="lock" size={20} color="#9CA3AF" />
                <TextInput
                  style={LoginStyles.textInput}
                  placeholder="Nhập mật khẩu"
                  placeholderTextColor="#9CA3AF"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity style={LoginStyles.eyeButton} onPress={() => setShowPassword(!showPassword)}>
                  {/* Eye icon to show/hide password */}
                  <Text style={LoginStyles.eyeIcon}>
                    {showPassword ? <Icon name="eye" size={20} color="#000" /> : <Icon name="eye-slash" size={20} color="#000" />}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Remember Me & Forgot Password */}
            <View style={LoginStyles.optionsRow}>
              <TouchableOpacity style={LoginStyles.rememberContainer} onPress={() => setRememberMe(!rememberMe)}>
                <View style={[LoginStyles.checkbox, rememberMe && LoginStyles.checkboxChecked]}>
                  {rememberMe && <Text style={LoginStyles.checkmark}>✓</Text>}
                </View>
                <Text style={LoginStyles.rememberText}>Ghi nhớ đăng nhập</Text>
              </TouchableOpacity>

              <TouchableOpacity>
                <Text style={LoginStyles.forgotText}>Quên mật khẩu?</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[LoginStyles.loginButton, isLoading && LoginStyles.loginButtonLoading]}
              onPress={handleLogin}
              activeOpacity={0.8}
              disabled={isLoading}
            >
              {isLoading ? (
                <Text style={LoginStyles.loadingText}>Đang đăng nhập...</Text>
              ) : (
                <Text style={LoginStyles.loginButtonText}>Đăng nhập</Text>
              )}
            </TouchableOpacity>

            
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {/* Footer */}
      <View style={LoginStyles.footer}>
        <Text style={LoginStyles.footerText}>© 2025 POWERED BY SOF.VN</Text>
      </View>
      <NotifyModal
        visible={notify.visible}
        type={notify.type as any}
        title={notify.type === "error" ? "Đăng nhập thất bại" : undefined}
        message={notify.message}
        onClose={() => setNotify({ ...notify, visible: false })}
      />
    </SafeAreaView>
  )
}

export default LoginScreen
