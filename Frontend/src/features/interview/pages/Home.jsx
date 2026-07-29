import react from "react";
import "../style/Home.scss"

const Home=()=>{
    return(
        <main className="home">
            <div className="interview-input-group">
                <div className="left">
                <p>Job Description</p>
                    <textarea name="jobDescription" id="jobDescription" placeholder="Enter job description here"></textarea>
                </div>
                <div className="right">
                    <div className="input-group">
                        <p>Resume<small classname="highlight">(Use Resume and elf description together for best result)</small></p>
                        <label className="file-label" htmlFor="resume">Upload Resume</label>
                        <input hidden type="file" name="resume" id="resume" accept=".pdf"></input>
                    </div>
                    <div className="input-group">
                        <label htmlFor="selfDescription">Self Description</label>
                        <textarea name="selfDescription" id="selfDescription" placeholder="Enter self description here"></textarea>
                    </div>
                    <button className="button primary-button">Generate Inteview Report</button>
                </div>
            </div>
        </main>
    )
}

export default Home