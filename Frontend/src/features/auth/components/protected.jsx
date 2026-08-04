import {useAuth} from "../hooks/useAuth";
import { Navigate } from "react-router-dom";
import react from "react";

const Protected = ({children}) => {

    const {loading,user} = useAuth();

    if (loading) {
        return (
            <main className='loading-screen'>
                <div className='loading-container'>
                    <div className='loader-orb'>
                        <div className='orb-glow'></div>
                        <div className='orb-outer'></div>
                        <div className='orb-inner'></div>
                        <div className='orb-core'></div>
                    </div>
                    <div className='loading-text'>
                        <h2>Verifying Session</h2>
                        <p>Please wait while we check your login status...</p>
                    </div>
                    <div className='loading-progress-bar'>
                        <div className='progress-fill'></div>
                    </div>
                </div>
            </main>
        )
    }

    if(!user){
        return <Navigate to="/login" />
    }  

    return children;
}

export default Protected;