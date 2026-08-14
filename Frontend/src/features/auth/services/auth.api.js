import axios from "axios"

const api = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:3000",
    withCredentials: true
})

api.interceptors.request.use((config) => {
    const token = localStorage.getItem("token")
    if (token) {
        config.headers.Authorization = `Bearer ${token}`
    }
    return config
}, (error) => {
    return Promise.reject(error)
})

export async function register({username,email,password}) {
    const response=await api.post("/api/auth/register",
        {username,email,password},
    )
    return response.data
}

export async function login({email,password}) {
    const response=await api.post("/api/auth/login",
        {email,password},
    )
    return response.data
}
export async function logout() {
    try{
        const response = await api.post("/api/auth/logout")
        return response.data
    }
    catch(error){
        console.log(error)
    }
}
export async function me() {
    try{
        const response=await api.get("/api/auth/me")
        return response.data
    }
    catch(error){
        console.log(error)
    }
}