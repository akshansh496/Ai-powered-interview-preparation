import {useContext} from 'react';
import {AuthContext} from '../auth.context'; 
import {register,login,logout,me} from "../services/auth.api";

export const useAuth = () => {
    const context=useContext(AuthContext)
    const {user,setUser,loading,setLoading}=context

    const handleLogin=async ({email,password})=>{
        setLoading(true)
        try{
            const data=await login({email,password})
            if (data?.token) {
                localStorage.setItem("token", data.token)
            }
            setUser(data.user)
            return data.user
        }
        catch(error){
            console.error(error)
            throw error
        }
        finally{
            setLoading(false)
        }
    }
    const handleRegister=async ({username,email,password})=>{
        setLoading(true)
        try{
            const data=await register({username,email,password})
            if (data?.token) {
                localStorage.setItem("token", data.token)
            }
            setUser(data.user)
            return data.user
        }
        catch(error){
            console.error(error)
            throw error
        }
        finally{
            setLoading(false)
        }
    }
    const handleLogout=async ()=>{
        setLoading(true)
        try{
            await logout()
            localStorage.removeItem("token")
            setUser(null)
        }
        catch(error){
            console.log(error)
        }
        finally{
            setLoading(false)
        }
    }
    return {
        user,
        loading,
        handleLogin,
        handleRegister,
        handleLogout,
    };
}