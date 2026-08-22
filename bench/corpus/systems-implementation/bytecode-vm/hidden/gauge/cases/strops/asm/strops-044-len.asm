; case strops-044-len
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_STR ""
  LEN
  PRINT
  RET
.end
