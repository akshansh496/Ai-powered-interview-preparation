import {useState,createContext,useEffect} from "react"
import {me} from "./services/auth.api"

export const AuthContext=createContext()

export const AuthProvider=({children})=>{
    const [user,setUser]=useState(null)

    const [loading,setLoading]=useState(true)

    useEffect(()=>{
        const getAndSetUser=async()=>{
            try {
                const data = await me();
                setUser(data.user);
            } catch (err) {
                console.log(err);
                setUser(null);
            } finally {
                setLoading(false);
            }
        }
        getAndSetUser()
    },[])

    return (
        <AuthContext.Provider value={{user,setUser,loading,setLoading}}>
            {children}
        </AuthContext.Provider>
    )
}