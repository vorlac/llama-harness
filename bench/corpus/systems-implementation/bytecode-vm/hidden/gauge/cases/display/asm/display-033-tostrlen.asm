; case display-033-tostrlen
; expect exit=0 stdout="8\n"
.func main arity=0 locals=0
  PUSH_STR "tab\there"
  TOSTR
  LEN
  PRINT
  RET
.end
