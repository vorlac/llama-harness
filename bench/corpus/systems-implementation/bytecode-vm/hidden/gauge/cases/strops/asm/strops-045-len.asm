; case strops-045-len
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  LEN
  PRINT
  RET
.end
