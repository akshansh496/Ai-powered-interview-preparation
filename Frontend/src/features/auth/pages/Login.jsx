import React,{ useState } from 'react'
import '../auth.form.scss'
import {Link,useNavigate} from 'react-router-dom'
import { useAuth } from '../hooks/useAuth';

const Login=() => {

    const{loading,handleLogin} = useAuth();
    const navigate = useNavigate();

    const[email,setEmail] = useState('');
    const[password,setPassword] = useState('');


    const handleSubmit = async (e) => {
        e.preventDefault();
        await handleLogin({email,password});
        navigate('/'); 
    }

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
                        <h2>Authenticating</h2>
                        <p>Securing your session and connecting to your dashboard...</p>
                    </div>
                    <div className='loading-progress-bar'>
                        <div className='progress-fill'></div>
                    </div>
                </div>
            </main>
        )
    }

    return (
        <main>
            <div className="form-container">
                <h1>Login</h1>
                <form onSubmit={handleSubmit}>
                    <div className="input-group">
                        <label htmlFor='email'>Email</label>
                        <input
                         onChange={(e)=>setEmail(e.target.value)}
                         type="email" id="email" name="email" placeholder='Enter your email' />
                    </div>
                    <div className="input-group">
                        <label htmlFor='password'>Password</label>
                        <input
                         onChange={(e)=>setPassword(e.target.value)}
                         type="password" id="password" name="password" placeholder='Enter password' />
                    </div>
                    <button className="button primary-button">Login </button>
                </form>
                <p>Don't have an account? <Link to={"/register"}>Register</Link></p>
            </div>
        </main>
    )
}
export default Login;