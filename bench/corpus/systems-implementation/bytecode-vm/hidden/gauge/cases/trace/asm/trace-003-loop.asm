; case trace-003-loop
; expect exit=0 stdout="9\n"
; The integer 0 is truthy (SPEC.md section 7.2), so the loop condition is an
; explicit comparison rather than the counter itself.
.func main arity=0 locals=1
  PUSH_INT 2
  STORE_LOCAL 0
top:
  LOAD_LOCAL 0
  PUSH_INT 0
  NE
  JMP_IF_FALSE out
  LOAD_LOCAL 0
  PUSH_INT 1
  SUB
  STORE_LOCAL 0
  JMP top
out:
  PUSH_INT 9
  PRINT
  RET
.end
