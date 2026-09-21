import React,{ useState } from 'react'
import '../auth.form.scss'
import {Link,useNavigate} from 'react-router-dom'
import { useAuth } from '../hooks/useAuth';

const Login=() => {

    const{loading,handleLogin} = useAuth();
    const navigate = useNavigate();

    const[email,setEmail] = useState('');
    const[password,setPassword] = useState('');
    const[error,setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!email.trim()) {
            setError("Email field is required");
            return;
        }
        if (!password.trim()) {
            setError("Password field is required");
            return;
        }
        setError('');
        try {
            const user = await handleLogin({email,password});
            if (user) {
                navigate('/');
            }
        } catch (err) {
            const errMsg = err.response?.data?.message || err.message || "Failed to log in";
            setError(errMsg);
        }
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
                <div className="auth-brand">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="brand-icon"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                    <span>InterviewAI</span>
                </div>
                <div className="auth-header">
                    <h1>Login</h1>
                    <p>Welcome back! Enter your details to continue.</p>
                </div>
                {error && (
                    <div className="auth-error-banner">
                        {error}
                    </div>
                )}
                <form onSubmit={handleSubmit}>
                    <div className="input-group">
                        <label htmlFor='email'>Email Address</label>
                        <input
                         onChange={(e)=>setEmail(e.target.value)}
                         type="email" id="email" name="email" placeholder='name@company.com' />
                    </div>
                    <div className="input-group">
                        <label htmlFor='password'>Password</label>
                        <input
                         onChange={(e)=>setPassword(e.target.value)}
                         type="password" id="password" name="password" placeholder='••••••••' />
                    </div>
                    <button className="button primary-button">Login</button>
                </form>
                <p>Don't have an account? <Link to={"/register"}>Register</Link></p>
            </div>
        </main>
    )
}
export default Login;