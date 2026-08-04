import React,{ useState } from 'react'
import {Link,useNavigate} from 'react-router-dom'
import {useAuth} from '../hooks/useAuth';

const Register=() => {

    const navigate = useNavigate();
    const [username,setUsername] = useState('');
    const [email,setEmail] = useState('');
    const [password,setPassword] = useState('');

    const {loading,handleRegister} = useAuth();

    const handleSubmit = async (e) => {
        e.preventDefault();
        await handleRegister({username,email,password});
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
                        <h2>Creating Account</h2>
                        <p>Setting up your profile and preparing your personalized workspace...</p>
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
                <h1>Register</h1>
                <form onSubmit={handleSubmit}>
                    <div className="input-group">
                        <label htmlFor='username'>Username</label>
                        <input
                        onChange={(e)=>setUsername(e.target.value)}
                        type="text" id="username" name="username" placeholder='Enter your username' />
                    </div>
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
                    <button className="button primary-button">Register </button>
                </form>
                <p>Already have an account? <Link to={"/login"}>Login</Link></p>
            </div>
        </main>
    )
}
export default Register;