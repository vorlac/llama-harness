; case display-074-typeofstr
; expect exit=0 stdout="str\n"
.func main arity=0 locals=0
  PUSH_INT 1
  TYPEOF
  TYPEOF
  PRINT
  RET
.end
