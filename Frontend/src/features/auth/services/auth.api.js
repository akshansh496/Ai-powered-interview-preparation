import axios from "axios"

const api=axios.create({
    baseURL:"http://localhost:3000",
    withCredentials:true
})

export async function register({username,email,password}) {
    try{
        const response=await api.post("/api/auth/register",
            {username,email,password},
        )
        return response.data
    }
    catch(error){
        console.log(error)
    }
}

export async function login({email,password}) {
    try{
        const response=await api.post("/api/auth/login",
            {email,password},
        )
        return response.data
    }
    catch(error){
        console.log(error)
    }
}
export async function logout() {
    try{
        const response=await axios.post("/api/auth/logout")
        return response.data
    }
    catch(error){
        console.log(error)
    }
}
export async function me() {
    try{
        const response=await api.post("/api/auth/me")
        return response.data
    }
    catch(error){
        console.log(error)
    }
}